import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { spyGit } from '../fixtures/spy-git.js';
import { fakeHttp, type FakeHttpRoutes } from '../fixtures/fake-http.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'url-source-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(routes: FakeHttpRoutes = () => []) {
  return new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(routes));
}

describe('normalize dispatches a direct-download URL (source-formats ticket 03)', () => {
  it('dispatches an https URL on a non-git-hosting domain to kind url', () => {
    const spec = service().normalize('https://example.com/skills/alpha/SKILL.md');
    expect(spec.kind).toBe('url');
    expect(spec.isLocal).toBe(false);
    expect(spec.repoUrl).toBe('https://example.com/skills/alpha/SKILL.md');
  });

  it('dispatches a plain-http URL to kind url too — the confirmation gate is a checkout concern', () => {
    expect(service().normalize('http://example.com/SKILL.md').kind).toBe('url');
  });

  it('dispatches a URL with a port on a non-git-hosting host to kind url', () => {
    expect(service().normalize('http://127.0.0.1:4777/SKILL.md').kind).toBe('url');
  });

  it('keeps github.com URLs other than the plain repo shape on the git path — existence of the domain is the dispatch condition', () => {
    expect(service().normalize('https://github.com/owner/repo/blob/main/skills/alpha/SKILL.md').kind).toBe('git');
  });

  it('keeps gitlab.com and huggingface.co URLs on the git path (npx skills exclusion table)', () => {
    expect(service().normalize('https://gitlab.com/owner/repo/-/blob/main/SKILL.md').kind).toBe('git');
    expect(service().normalize('https://huggingface.co/owner/repo/resolve/main/SKILL.md').kind).toBe('git');
  });

  it('keeps subdomains of git-hosting domains on the git path', () => {
    expect(service().normalize('https://gist.github.com/owner/gist-id').kind).toBe('git');
    expect(service().normalize('https://about.gitlab.com/skills/').kind).toBe('git');
  });

  it('treats raw.githubusercontent.com as a direct-download host — it is not in the git-hosting table', () => {
    expect(service().normalize('https://raw.githubusercontent.com/owner/repo/main/SKILL.md').kind).toBe('url');
  });

  it('keeps non-http(s) remote inputs on the git fallback — ssh URLs and friends never become download sources', () => {
    expect(service().normalize('git@github.com:owner/repo.git').kind).toBe('git');
    expect(service().normalize('ssh://git@example.com/repo.git').kind).toBe('git');
  });

  it('leaves the pre-existing dispatch order intact: local paths, owner/repo shorthand, GitHub tree and repo URLs (regression)', () => {
    const s = service();
    const local = path.join(root, 'local-repo');
    mkdirSync(path.join(local, 'skills'), { recursive: true });
    expect(s.normalize(local).kind).toBe('local');
    expect(s.normalize('owner/repo').kind).toBe('git');
    expect(s.normalize('https://github.com/owner/repo').kind).toBe('git');
    expect(s.normalize('https://github.com/owner/repo/tree/main/skills/alpha').kind).toBe('git');
  });
});

function coreServices(routes: FakeHttpRoutes) {
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
    http: fakeHttp(routes),
  });
  s.skillHome.ensure();
  return s;
}

describe('checkout downloads a single SKILL.md URL into a temp checkout (source-formats ticket 03)', () => {
  it('materializes the minimal skill tree skills/<name>/SKILL.md and reports no commit', () => {
    const s = service(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]);
    const checkout = s.checkout('https://example.com/SKILL.md');
    expect(checkout.kind).toBe('url');
    expect(checkout.commit).toBeNull();
    const discovered = s.discover(checkout);
    expect(discovered.map((skill) => skill.name)).toEqual(['alpha']);
    expect(discovered.map((skill) => skill.subpath)).toEqual(['skills/alpha']);
    expect(createNodeFileSystem().readText(path.join(checkout.repoDir, 'skills', 'alpha', 'SKILL.md'))).toBe(skillMarkdown('alpha'));
    s.release(checkout);
  });

  it('supports the withCheckout lifecycle: temp swept after the callback', () => {
    const fs = createNodeFileSystem();
    const s = new SourceService(fs, spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]));
    let repoDir = '';
    s.withCheckout('https://example.com/SKILL.md', undefined, (checkout) => {
      repoDir = checkout.repoDir;
      expect(fs.kind(path.join(repoDir, 'skills', 'alpha', 'SKILL.md'))).toBe('file');
    });
    expect(fs.kind(path.dirname(repoDir))).toBe('missing');
  });

  it('installs from a URL source and records url provenance with no git anchors', () => {
    const s = coreServices(() => [{ kind: 'bytes', body: skillMarkdown('alpha', 'a url skill') }]);
    const result = s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });
    expect(result.installed).toEqual(['alpha']);

    const entry = s.registry.load().skills.alpha?.source;
    expect(entry?.type).toBe('url');
    expect(entry?.url).toBe('https://example.com/SKILL.md');
    expect(entry?.subpath).toBe('skills/alpha');
    expect(entry?.upstream_commit).toBeNull();
    expect(entry?.upstream_tree).toBeNull();
    expect(entry && 'upstream_digest' in entry).toBe(false);
    expect(createNodeFileSystem().kind(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toBe('file');
  });

  it('records the download response headers as the update pre-check validators (US-24, ADR-0016)', () => {
    const s = coreServices(() => [{
      kind: 'bytes',
      body: skillMarkdown('alpha', 'a url skill'),
      headers: { etag: '"v1"', lastModified: 'Wed, 09 Sep 2026 10:00:00 GMT' },
    }]);
    s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });

    const source = s.registry.load().skills.alpha?.source;
    expect(source?.upstream_etag).toBe('"v1"');
    expect(source?.upstream_last_modified).toBe('Wed, 09 Sep 2026 10:00:00 GMT');
  });

  it('records null validators when the server sends none, and none for non-url sources either', () => {
    const s = coreServices(() => [{ kind: 'bytes', body: skillMarkdown('alpha', 'a url skill') }]);
    s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });
    const urlSource = s.registry.load().skills.alpha?.source;
    expect(urlSource?.upstream_etag).toBeNull();
    expect(urlSource?.upstream_last_modified).toBeNull();

    const localDir = path.join(root, 'local-src', 'skills', 'beta');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(path.join(localDir, 'SKILL.md'), '---\nname: beta\ndescription: local\n---\n');
    s.install.installFromSourceSelection({ source: path.join(root, 'local-src'), selectors: ['beta'] });
    const localSource = s.registry.load().skills.beta?.source;
    expect(localSource?.type).toBe('local');
    expect(localSource?.upstream_etag).toBeNull();
    expect(localSource?.upstream_last_modified).toBeNull();
  });
});

describe('a payload that is not a single SKILL.md fails actionably (US-6/31)', () => {
  it('rejects non-markdown content (binary garbage, HTML page) with url_payload_invalid', () => {
    const s = service(() => [{ kind: 'bytes', body: '<html><body>not a skill</body></html>' }]);
    expect(() => s.checkout('https://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'url_payload_invalid' }));
  });

  it('rejects markdown whose frontmatter lacks name or description', () => {
    const missingDescription = service(() => [{ kind: 'bytes', body: '---\nname: alpha\n---\n# prose only\n' }]);
    expect(() => missingDescription.checkout('https://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'url_payload_invalid' }));
    const missingName = service(() => [{ kind: 'bytes', body: '---\ndescription: no name here\n---\n# prose\n' }]);
    expect(() => missingName.checkout('https://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'url_payload_invalid' }));
  });

  it('rejects a path-traversal frontmatter name through the existing untrusted-metadata check', () => {
    const s = service(() => [{ kind: 'bytes', body: '---\nname: ../../evil\ndescription: smuggled\n---\n# evil\n' }]);
    expect(() => s.checkout('https://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'invalid_skill_name' }));
  });

  it('rejects a non-2xx download outcome with the transport failure code', () => {
    const s = service(() => [{ kind: 'status', status: 404 }]);
    expect(() => s.checkout('https://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'download_failed' }));
  });
});

describe('plain-http downloads require explicit confirmation (US-12)', () => {
  it('refuses an unconfirmed http download — the transport is never even called', () => {
    const port = fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, port);
    expect(() => s.checkout('http://example.com/SKILL.md')).toThrow(expect.objectContaining({ code: 'insecure_http_unconfirmed' }));
    expect(port.calls).toHaveLength(0);
  });

  it('downloads after the caller passes allowInsecureHttp', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]));
    const checkout = s.checkout('http://example.com/SKILL.md', undefined, { allowInsecureHttp: true });
    expect(checkout.kind).toBe('url');
    s.release(checkout);
  });

  it('installFromSourceSelection forwards the confirmation through withCheckout', () => {
    const port = fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]);
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
      http: port,
    });
    s.skillHome.ensure();
    expect(() => s.install.installFromSourceSelection({ source: 'http://example.com/SKILL.md', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'insecure_http_unconfirmed' }),
    );
    expect(port.calls).toHaveLength(0);
    expect(s.install.installFromSourceSelection({ source: 'http://example.com/SKILL.md', selectors: ['alpha'], allowInsecureHttp: true }).installed).toEqual(['alpha']);
  });

  it('https URLs download without any confirmation', () => {
    const s = service(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]);
    const checkout = s.checkout('https://example.com/SKILL.md');
    expect(checkout.kind).toBe('url');
    s.release(checkout);
  });
});

describe('transport bounds surface as distinguishable errors through checkout (US-13/14, fake port)', () => {
  it('follows up to five redirects and refuses the sixth', () => {
    const chain: FakeHttpRoutes = (url) => {
      const hop = Number(new URL(url).searchParams.get('hop') || '0');
      return hop < 5 ? [{ kind: 'redirect', to: `https://example.com/SKILL.md?hop=${hop + 1}` }] : [{ kind: 'bytes', body: skillMarkdown('alpha') }];
    };
    const s = service(chain);
    const checkout = s.checkout('https://example.com/SKILL.md');
    expect(checkout.kind).toBe('url');
    s.release(checkout);

    const loop: FakeHttpRoutes = (url) => {
      const hop = Number(new URL(url).searchParams.get('hop') || '0');
      return [{ kind: 'redirect', to: `https://example.com/SKILL.md?hop=${hop + 1}` }];
    };
    expect(() => service(loop).checkout('https://example.com/SKILL.md')).toThrow(
      expect.objectContaining({ code: 'download_redirect_limit' }),
    );
  });

  it('enforces the download size limit on the stream — the configured request reaches the transport', () => {
    const port = fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, port, {
      maxBytes: 8,
      maxRedirects: 5,
      connectTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
    });
    expect(() => s.checkout('https://example.com/SKILL.md')).toThrow(
      expect.objectContaining({ code: 'download_size_exceeded' }),
    );
  });

  it('reports connect and idle timeouts as distinct actionable failures', () => {
    expect(() => service(() => [{ kind: 'connect-timeout' }]).checkout('https://example.com/SKILL.md')).toThrow(
      expect.objectContaining({ code: 'download_connect_timeout' }),
    );
    expect(() => service(() => [{ kind: 'idle-timeout' }]).checkout('https://example.com/SKILL.md')).toThrow(
      expect.objectContaining({ code: 'download_idle_timeout' }),
    );
  });

  it('cleans the half-built temp checkout when the transport fails (same hygiene as a failed clone)', () => {
    const fs = createNodeFileSystem();
    const s = new SourceService(fs, spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'connect-timeout' }]));
    let repoDir = '';
    expect(() =>
      s.withCheckout('https://example.com/SKILL.md', undefined, (checkout) => {
        repoDir = checkout.repoDir;
      }),
    ).toThrow(expect.objectContaining({ code: 'download_connect_timeout' }));
    expect(repoDir).toBe('');
    const tmp = path.join(root, 'tmp');
    const leftovers = fs.kind(tmp) === 'directory' ? fs.readDirectory(tmp) : [];
    expect(leftovers).toHaveLength(0);
  });
});
