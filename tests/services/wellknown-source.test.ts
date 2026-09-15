import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DetectionService } from '../../src/core/services/detection-service.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { buildZip, skillMarkdown } from '../fixtures/archives.js';
import { spyGit } from '../fixtures/spy-git.js';
import { fakeHttp, type FakeHttpRoutes, type FakeHttpStep } from '../fixtures/fake-http.js';

const V2_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const ROOT_INDEX_URL = 'https://example.com/.well-known/agent-skills/index.json';

function sha256(data: string | Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

/** A V2 discovery index fixture body. */
function wellknownIndex(entries: unknown[]): string {
  return JSON.stringify({ $schema: V2_SCHEMA, skills: entries });
}

function skillMdEntry(url: string, digest: string, name = 'alpha', description = 'an indexed skill') {
  return { name, description, type: 'skill-md', url, digest };
}

/** Route table for a well-known site: the index at the site root plus a map of artifact paths. */
function wellknownSite(options: { indexUrl?: string; index: string; files?: Record<string, string | Buffer> }): FakeHttpRoutes {
  const indexUrl = options.indexUrl ?? ROOT_INDEX_URL;
  return (url) => {
    if (url === indexUrl) return [{ kind: 'bytes', body: options.index }];
    const file = options.files?.[url];
    if (file !== undefined) return [{ kind: 'bytes', body: file }];
    return [{ kind: 'status', status: 404 }];
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wellknown-source-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function coreServices(routes: FakeHttpRoutes) {
  const http = fakeHttp(routes);
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
    http,
  });
  s.skillHome.ensure();
  return { s, http };
}

describe('a V2 index hit installs through the well-known flow (source-formats ticket 07)', () => {
  it('installs a skill-md entry and records wellknown provenance with the digest anchor', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]),
      files: { 'https://example.com/.well-known/agent-skills/files/alpha.md': body },
    }));

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });

    expect(result.installed).toEqual(['alpha']);
    const source = s.registry.load().skills.alpha?.source;
    expect(source?.type).toBe('wellknown');
    expect(source?.upstream_digest).toBe(sha256(body));
    expect(source?.upstream_tree).toBeNull();
    expect(source?.upstream_commit).toBeNull();
    expect(createNodeFileSystem().kind(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toBe('file');
  });

  it('resolves a relative artifact URL against the index.json URL, not the source URL', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]),
      files: { 'https://example.com/.well-known/agent-skills/files/alpha.md': body },
    }));

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });

    expect(result.installed).toEqual(['alpha']);
    expect(s.registry.load().skills.alpha?.source?.url).toBe('https://example.com/skills');
  });
});

describe('candidate-path probing (two names × site root / basePath, ticket AC)', () => {
  const BASE_CANDIDATES = [
    'https://example.com/.well-known/agent-skills/index.json',
    'https://example.com/.well-known/skills/index.json',
    'https://example.com/team/.well-known/agent-skills/index.json',
    'https://example.com/team/.well-known/skills/index.json',
  ];

  it('probes both names at the site root first, then both under the basePath — a legacy-name index serves the install', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const legacyIndex = wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]);
    const { s } = coreServices((url) => {
      if (url === 'https://example.com/team/.well-known/skills/index.json') return [{ kind: 'bytes', body: legacyIndex }];
      if (url === 'https://example.com/team/.well-known/skills/files/alpha.md') return [{ kind: 'bytes', body }];
      return [{ kind: 'status', status: 404 }];
    });

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/team/skills', selectors: ['alpha'] });

    expect(result.installed).toEqual(['alpha']);
    expect(s.registry.load().skills.alpha?.source?.type).toBe('wellknown');
  });

  it('the full probe sequence for a basePath URL is exactly the four combinations in order', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s, http } = coreServices((url): FakeHttpStep[] => {
      if (url === 'https://example.com/team/.well-known/agent-skills/index.json') {
        return [{ kind: 'bytes', body: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]) }];
      }
      if (url === 'https://example.com/team/.well-known/agent-skills/files/alpha.md') return [{ kind: 'bytes', body }];
      return [{ kind: 'status', status: 404 }];
    });

    s.install.installFromSourceSelection({ source: 'https://example.com/team/skills', selectors: ['alpha'] });

    expect(http.calls).toEqual([
      ...BASE_CANDIDATES.slice(0, 3).map((url) => `GET ${url}`),
      'GET https://example.com/team/.well-known/agent-skills/files/alpha.md',
    ]);
  });

  it('a site-root URL probes only the two root combinations', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s, http } = coreServices((url): FakeHttpStep[] => {
      if (url === ROOT_INDEX_URL) {
        return [{ kind: 'bytes', body: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]) }];
      }
      if (url === 'https://example.com/.well-known/agent-skills/files/alpha.md') return [{ kind: 'bytes', body }];
      return [{ kind: 'status', status: 404 }];
    });

    s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });

    expect(http.calls).toEqual([
      `GET ${ROOT_INDEX_URL}`,
      'GET https://example.com/.well-known/agent-skills/files/alpha.md',
    ]);
  });

  it('every candidate misses — the source falls back to plain direct download (tickets 03/04 unregressed)', () => {
    const body = skillMarkdown('alpha', 'a direct download');
    const { s, http } = coreServices((url) => (url === 'https://example.com/team/skills' ? [{ kind: 'bytes', body }] : [{ kind: 'status', status: 404 }]));

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/team/skills', selectors: ['alpha'] });

    expect(result.installed).toEqual(['alpha']);
    expect(s.registry.load().skills.alpha?.source?.type).toBe('url');
    expect(http.calls).toEqual([...BASE_CANDIDATES.map((url) => `GET ${url}`), 'GET https://example.com/team/skills']);
  });
});

describe('V2-only acceptance — an index that answers is never guessed around (ticket AC)', () => {
  function siteWithIndex(index: string) {
    return coreServices(wellknownSite({ index }));
  }

  it('a missing $schema is refused with wellknown_index_unsupported — no fall-through to direct download', () => {
    const { s } = siteWithIndex(JSON.stringify({ skills: [skillMdEntry('files/alpha.md', `sha256:${'0'.repeat(64)}`)] }));
    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_index_unsupported' }),
    );
  });

  it('a V1-style index (files model, non-0.2.0 schema) is refused, not consumed', () => {
    const v1 = JSON.stringify({ $schema: 'https://schemas.agentskills.io/discovery/0.1.0/schema.json', files: [{ path: 'alpha/SKILL.md' }] });
    const { s } = siteWithIndex(v1);
    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_index_unsupported' }),
    );
  });

  it('a future schema version (0.3.0) is refused — non-0.2.0 is a rejection, per the ratification', () => {
    const v3 = JSON.stringify({ $schema: 'https://schemas.agentskills.io/discovery/0.3.0/schema.json', skills: [] });
    const { s } = siteWithIndex(v3);
    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_index_unsupported' }),
    );
  });

  it('a $schema that merely embeds the 0.2.0 identifier elsewhere (foreign host, query string) is refused', () => {
    const smuggled = JSON.stringify({ $schema: 'https://evil.example/?x=https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills: [] });
    const { s } = siteWithIndex(smuggled);
    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_index_unsupported' }),
    );
  });

  it('the bare identifier spelling (no scheme, no /schema.json suffix) is an accepted equivalent', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s } = coreServices(wellknownSite({
      index: JSON.stringify({ $schema: 'schemas.agentskills.io/discovery/0.2.0', skills: [skillMdEntry('files/alpha.md', sha256(body))] }),
      files: { 'https://example.com/.well-known/agent-skills/files/alpha.md': body },
    }));

    expect(s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] }).installed).toEqual(['alpha']);
  });

  it('a first candidate answering non-JSON HTML keeps probing; a later V2 hit still wins', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const { s, http } = coreServices((url) => {
      if (url === 'https://example.com/.well-known/agent-skills/index.json') return [{ kind: 'bytes', body: '<html>502 page</html>' }];
      if (url === 'https://example.com/.well-known/skills/index.json') return [{ kind: 'bytes', body: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]) }];
      if (url === 'https://example.com/.well-known/skills/files/alpha.md') return [{ kind: 'bytes', body }];
      return [{ kind: 'status', status: 404 }];
    });

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });

    expect(result.installed).toEqual(['alpha']);
    expect(http.calls[0]).toBe(`GET ${ROOT_INDEX_URL}`);
    expect(http.calls[1]).toBe('GET https://example.com/.well-known/skills/index.json');
  });
});

describe('digest enforcement (ticket AC — index/content mismatch is caught)', () => {
  it('an artifact whose bytes hash to a different digest fails the install', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const tampered = `${body}\n<!-- tampered -->`;
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([skillMdEntry('files/alpha.md', sha256(body))]),
      files: { 'https://example.com/.well-known/agent-skills/files/alpha.md': tampered },
    }));

    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_digest_mismatch' }),
    );
    expect(s.registry.load().skills.alpha).toBeUndefined();
  });

  it('an entry without a valid sha256 digest makes the index invalid — unverifiable artifacts never install', () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const entry = { name: 'alpha', description: 'an indexed skill', type: 'skill-md', url: 'files/alpha.md', digest: 'md5:abc' };
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([entry]),
      files: { 'https://example.com/.well-known/agent-skills/files/alpha.md': body },
    }));

    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'wellknown_index_invalid' }),
    );
  });

  it('an entry with an unknown type or a duplicate name makes the index invalid', () => {
    const digest = `sha256:${'0'.repeat(64)}`;
    const unknownType = wellknownIndex([{ name: 'alpha', description: 'x', type: 'plugin', url: 'a.md', digest }]);
    expect(() => {
      const { s } = coreServices(wellknownSite({ index: unknownType }));
      s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });
    }).toThrow(expect.objectContaining({ code: 'wellknown_index_invalid' }));

    const duplicate = wellknownIndex([
      skillMdEntry('files/a.md', digest),
      skillMdEntry('files/b.md', digest, 'alpha'),
    ]);
    expect(() => {
      const { s } = coreServices(wellknownSite({ index: duplicate }));
      s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });
    }).toThrow(expect.objectContaining({ code: 'wellknown_index_invalid' }));
  });

  it('a hostile entry name is rejected through the untrusted-metadata checks (US-31)', () => {
    const digest = `sha256:${'0'.repeat(64)}`;
    const evil = wellknownIndex([{ name: '../../evil', description: 'smuggled', type: 'skill-md', url: 'a.md', digest }]);
    expect(() => {
      const { s } = coreServices(wellknownSite({ index: evil }));
      s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] });
    }).toThrow(expect.objectContaining({ code: 'invalid_skill_name' }));
  });
});

describe('both entry types install (ticket AC)', () => {
  it('a skill-md entry lands as skills/<name>/SKILL.md even when the entry name differs from the frontmatter name', () => {
    const body = skillMarkdown('real-name', 'frontmatter wins');
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([skillMdEntry('files/real.md', sha256(body), 'listing-name')]),
      files: { 'https://example.com/.well-known/agent-skills/files/real.md': body },
    }));

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['real-name'] });

    expect(result.installed).toEqual(['real-name']);
  });

  it('an archive entry is unpacked with the full archive-safety path and installs its skills', () => {
    const zip = buildZip([
      { name: 'zeta/', data: undefined },
      { name: 'zeta/SKILL.md', data: skillMarkdown('zeta', 'from an archive entry') },
    ]);
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([
        { name: 'zeta-entry', description: 'from an archive entry', type: 'archive', url: 'files/zeta.zip', digest: sha256(zip) },
      ]),
      files: { 'https://example.com/.well-known/agent-skills/files/zeta.zip': zip },
    }));

    const result = s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['zeta'] });

    expect(result.installed).toEqual(['zeta']);
    const source = s.registry.load().skills.zeta?.source;
    expect(source?.type).toBe('wellknown');
    expect(source?.upstream_digest).toBe(sha256(zip));
    expect(source?.subpath).toBe('zeta-entry/zeta');
  });

  it('an archive entry whose bytes carry no archive magic is refused, not guessed', () => {
    const notAnArchive = 'definitely not a zip';
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([
        { name: 'bogus', description: 'lies about its type', type: 'archive', url: 'files/bogus.zip', digest: sha256(notAnArchive) },
      ]),
      files: { 'https://example.com/.well-known/agent-skills/files/bogus.zip': notAnArchive },
    }));

    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['x'] })).toThrow(
      expect.objectContaining({ code: 'url_payload_mismatch' }),
    );
  });

  it('a skill-md entry whose frontmatter is not a valid SKILL.md is refused at checkout', () => {
    const notASkill = '# just prose, no frontmatter';
    const { s } = coreServices(wellknownSite({
      index: wellknownIndex([skillMdEntry('files/prose.md', sha256(notASkill))]),
      files: { 'https://example.com/.well-known/agent-skills/files/prose.md': notASkill },
    }));

    expect(() => s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'url_payload_invalid' }),
    );
  });
});


describe('update detection keys on the index digest (ticket AC, ADR-0016)', () => {
  const remoteHeadNever = async () => {
    throw new Error('wellknown rows must never reach ls-remote');
  };
  const githubApiNever = {
    async fetchRepoTree() {
      throw new Error('wellknown rows must never reach the GitHub API');
    },
  };

  /** A mutable two-skill index site: assign `site.alpha` / `site.index` to
   *  simulate an upstream release. */
  function mutableSite() {
    const site: { index: string; alpha: string; beta: string } = {
      alpha: skillMarkdown('alpha', 'an indexed skill'),
      beta: skillMarkdown('beta', 'a second indexed skill'),
      index: '',
    };
    const setIndex = () => {
      site.index = wellknownIndex([
        skillMdEntry('files/alpha.md', sha256(site.alpha)),
        skillMdEntry('files/beta.md', sha256(site.beta), 'beta', 'a second indexed skill'),
      ]);
    };
    setIndex();
    const routes: FakeHttpRoutes = (url) => {
      if (url === ROOT_INDEX_URL) return [{ kind: 'bytes', body: site.index }];
      if (url === 'https://example.com/.well-known/agent-skills/files/alpha.md') return [{ kind: 'bytes', body: site.alpha }];
      if (url === 'https://example.com/.well-known/agent-skills/files/beta.md') return [{ kind: 'bytes', body: site.beta }];
      return [{ kind: 'status', status: 404 }];
    };
    const { s, http } = coreServices(routes);
    s.install.installFromSourceSelection({ source: 'https://example.com/skills', selectors: [] });
    const detection = new DetectionService({ githubApi: githubApiNever, fs: createNodeFileSystem(), remoteHead: remoteHeadNever, http });
    const bundle = { ...s, resolution: { root: path.join(root, 'home') } };
    const detect = () => detection.detect(bundle, s.registry.listSkills({ includeArchived: false }));
    return { s, http, site, setIndex, detect };
  }

  it('digest unchanged since install — the index re-pull alone decides, artifacts are not re-downloaded', async () => {
    const { http, detect } = mutableSite();

    const outcomes = await detect();

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(outcomes.get('beta')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(http.calls.filter((call) => call.includes('.well-known/agent-skills/files/'))).toHaveLength(2);
  });

  it('a digest change in the index flags the update — the artifact stays untouched until the update runs', async () => {
    const { s, http, site, setIndex, detect } = mutableSite();
    const installedDigest = s.registry.load().skills.alpha?.source?.upstream_digest;
    site.alpha = skillMarkdown('alpha', 'an indexed skill, renewed');
    setIndex();

    const outcomes = await detect();

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
    expect(outcomes.get('beta')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(s.registry.load().skills.alpha?.source?.upstream_digest).toBe(installedDigest);
    expect(http.calls.filter((call) => call.endsWith('/files/alpha.md'))).toHaveLength(1);
  });

  it('updateSkills reinstalls from the index and moves the registry anchor to the new digest', async () => {
    const { s, site, setIndex, detect } = mutableSite();
    site.alpha = skillMarkdown('alpha', 'an indexed skill, renewed');
    setIndex();
    await detect();

    const updated = s.update.updateSkills(['alpha']);

    expect(updated.updated).toEqual(['alpha']);
    expect(s.registry.load().skills.alpha?.source?.upstream_digest).toBe(sha256(site.alpha));
    expect(createNodeFileSystem().readText(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toContain('renewed');
  });

  it('an entry that vanished from the index is skipped, not a false update', async () => {
    const { site, detect } = mutableSite();
    site.index = wellknownIndex([
      skillMdEntry('files/beta.md', sha256(skillMarkdown('beta', 'a second indexed skill')), 'beta', 'a second indexed skill'),
    ]);

    const outcomes = await detect();

    expect(outcomes.get('alpha')).toEqual({ detection: 'skipped', hasUpdate: false });
  });
});
