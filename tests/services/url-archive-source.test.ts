import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { buildTar, buildTarGz, buildV7Tar, buildZip, skillMarkdown } from '../fixtures/archives.js';
import { SkillsManagerError } from '../../src/shared/errors.js';
import { parseFormatFlag } from '../../src/core/services/url-payload.js';
import type { ArchiveLimits } from '../../src/core/services/archive-safety.js';
import { spyGit } from '../fixtures/spy-git.js';
import { fakeHttp, type FakeHttpRoutes } from '../fixtures/fake-http.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'url-archive-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(routes: FakeHttpRoutes) {
  return new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(routes));
}

const zipPayload = () => buildZip([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha', 'zipped skill') }]);

describe('a zip archive URL installs in one step (source-formats ticket 04, US-2/8)', () => {
  it('checks out, discovers, and installs from a .zip URL with url provenance', () => {
    const s = service(() => [{ kind: 'bytes', body: zipPayload() }]);
    const checkout = s.checkout('https://example.com/pack.zip');
    expect(checkout.kind).toBe('url');
    expect(checkout.commit).toBeNull();
    const discovered = s.discover(checkout);
    expect(discovered.map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);

    const wired = coreServices(() => [{ kind: 'bytes', body: zipPayload() }]);
    const result = wired.install.installFromSourceSelection({ source: 'https://example.com/pack.zip', selectors: ['alpha'] });
    expect(result.installed).toEqual(['alpha']);
    const entry = wired.registry.load().skills.alpha?.source;
    expect(entry?.type).toBe('url');
    expect(entry?.upstream_tree).toBeNull();
    expect(createNodeFileSystem().kind(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toBe('file');
  });

  it('installs every skill in a multi-skill zip with empty selectors (the --all path)', () => {
    const payload = buildZip([
      { name: 'pkg/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'pkg/beta/SKILL.md', data: skillMarkdown('beta') },
    ]);
    const wired = coreServices(() => [{ kind: 'bytes', body: payload }]);
    const result = wired.install.installFromSourceSelection({ source: 'https://example.com/pack.zip', selectors: [] });
    expect(result.installed.sort()).toEqual(['alpha', 'beta']);
  });
});

describe('tar and tar.gz URLs install equally (source-formats ticket 04, US-3)', () => {
  it('installs a plain .tar URL through checkout and install', () => {
    const payload = buildTar([{ name: 'alpha/', typeflag: '5' }, { name: 'alpha/SKILL.md', data: skillMarkdown('alpha', 'tarred skill') }]);
    const wired = coreServices(() => [{ kind: 'bytes', body: payload }]);
    const result = wired.install.installFromSourceSelection({ source: 'https://example.com/pack.tar', selectors: ['alpha'] });
    expect(result.installed).toEqual(['alpha']);
    expect(wired.registry.load().skills.alpha?.source?.type).toBe('url');
  });

  it('installs a .tar.gz URL — the gzip wrapper is unwrapped by the gzip magic bytes', () => {
    const payload = buildTarGz([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha', 'gzipped tar skill') }]);
    const wired = coreServices(() => [{ kind: 'bytes', body: payload }]);
    const result = wired.install.installFromSourceSelection({ source: 'https://example.com/pack.tar.gz', selectors: ['alpha'] });
    expect(result.installed).toEqual(['alpha']);
    expect(createNodeFileSystem().kind(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toBe('file');
  });

  it('installs a .tgz URL the same way', () => {
    const payload = buildTarGz([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const s = service(() => [{ kind: 'bytes', body: payload }]);
    const checkout = s.checkout('https://example.com/pack.tgz');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });
});

describe('extension-less URLs fall back on Content-Type (source-formats ticket 04, US-4)', () => {
  it('routes application/zip to the zip extractor', () => {
    const s = service(() => [{ kind: 'bytes', body: zipPayload(), headers: { contentType: 'application/zip' } }]);
    const checkout = s.checkout('https://example.com/download');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('routes application/gzip to the tar family', () => {
    const payload = buildTarGz([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const s = service(() => [{ kind: 'bytes', body: payload, headers: { contentType: 'application/gzip' } }]);
    const checkout = s.checkout('https://example.com/download');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('routes text/markdown to the single-SKILL.md flow', () => {
    const s = service(() => [{ kind: 'bytes', body: skillMarkdown('alpha'), headers: { contentType: 'text/markdown; charset=utf-8' } }]);
    const checkout = s.checkout('https://example.com/download');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('installs a valid SKILL.md that nothing could predict (opaque content type, no extension)', () => {
    const s = service(() => [{ kind: 'bytes', body: skillMarkdown('alpha'), headers: { contentType: 'application/octet-stream' } }]);
    const checkout = s.checkout('https://example.com/download');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });
});

describe('a prediction contradicted by the content is an actionable mismatch (US-6)', () => {
  function checkoutError(routes: FakeHttpRoutes, url: string): SkillsManagerError {
    try {
      service(routes).checkout(url);
    } catch (error) {
      return error as SkillsManagerError;
    }
    throw new Error('expected checkout to throw');
  }

  it('refuses a .zip URL serving a tar archive, pointing at --format', () => {
    const error = checkoutError(() => [{ kind: 'bytes', body: buildTar([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]) }], 'https://example.com/pack.zip');
    expect(error.code).toBe('url_payload_mismatch');
    expect(error.message).toContain('--format tar');
  });

  it('refuses a .md URL serving zip bytes, pointing at --format zip', () => {
    const error = checkoutError(() => [{ kind: 'bytes', body: zipPayload() }], 'https://example.com/SKILL.md');
    expect(error.code).toBe('url_payload_mismatch');
    expect(error.message).toContain('--format zip');
  });

  it('refuses an md-predicted Content-Type serving an archive', () => {
    const error = checkoutError(() => [{ kind: 'bytes', body: zipPayload(), headers: { contentType: 'text/plain' } }], 'https://example.com/download');
    expect(error.code).toBe('url_payload_mismatch');
  });

  it('refuses a .tar URL serving non-archive content, pointing at --format md', () => {
    const error = checkoutError(() => [{ kind: 'bytes', body: skillMarkdown('alpha') }], 'https://example.com/pack.tar');
    expect(error.code).toBe('url_payload_mismatch');
    expect(error.message).toContain('--format md');
  });

  it('refuses a v7 tarball on a .tar URL as a mismatch — its bytes carry no tar magic (US-6)', () => {
    const error = checkoutError(() => [{ kind: 'bytes', body: buildV7Tar('alpha/SKILL.md', skillMarkdown('alpha', 'v7')) }], 'https://example.com/pack.tar');
    expect(error.code).toBe('url_payload_mismatch');
    expect(error.message).toContain('--format md');
  });

  it('never silently installs the mislabeled payload — the hub stays untouched', () => {
    const wired = coreServices(() => [{ kind: 'bytes', body: buildTar([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]) }]);
    expect(() => wired.install.installFromSourceSelection({ source: 'https://example.com/pack.zip', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'url_payload_mismatch' }),
    );
    expect(Object.keys(wired.registry.load().skills)).toHaveLength(0);
  });
});

describe('.tar.bz2 and .tar.xz are refused as unsupported archive formats (US-32)', () => {
  it('refuses a .tar.bz2 URL before anything is downloaded', () => {
    const port = fakeHttp(() => [{ kind: 'bytes', body: Buffer.from('BZh9whatever') }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, port);
    expect(() => s.checkout('https://example.com/pack.tar.bz2')).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
    expect(port.calls).toHaveLength(0);
  });

  it('refuses bzip2 magic bytes on an extension-less URL', () => {
    const s = service(() => [{ kind: 'bytes', body: Buffer.from('BZh9' + 'x'.repeat(64)) }]);
    expect(() => s.checkout('https://example.com/download')).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
  });

  it('refuses xz magic bytes on an extension-less URL', () => {
    const xzMagic = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x02]);
    const s = service(() => [{ kind: 'bytes', body: Buffer.concat([xzMagic, Buffer.alloc(64)]) }]);
    expect(() => s.checkout('https://example.com/download')).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
  });

  it('refuses a bzip2 Content-Type prediction', () => {
    const s = service(() => [{ kind: 'bytes', body: Buffer.alloc(16), headers: { contentType: 'application/x-bzip2' } }]);
    expect(() => s.checkout('https://example.com/download')).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
  });
});

describe('the --format escape hatch overrides prediction, not validation (US-5)', () => {
  const opaque = { contentType: 'application/octet-stream' };

  it('routes --format md to the single-SKILL.md flow when nothing predicts it', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: skillMarkdown('alpha'), headers: opaque }]));
    const checkout = s.checkout('https://example.com/download', undefined, { format: 'md' });
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('routes --format zip to the zip extractor', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: zipPayload(), headers: opaque }]));
    const checkout = s.checkout('https://example.com/download', undefined, { format: 'zip' });
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('routes --format tar to the tar family, gzip included', () => {
    const plain = buildTar([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const gzipped = buildTarGz([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp((url) => [
      { kind: 'bytes', body: url.endsWith('plain') ? plain : gzipped, headers: opaque },
    ]));
    for (const suffix of ['plain', 'gz']) {
      const checkout = s.checkout(`https://example.com/download?${suffix}`, undefined, { format: 'tar' });
      expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
      s.release(checkout);
    }
  });

  it('installFromSourceSelection forwards the forced format — auto judgment would misfire here', () => {
    // A .zip URL serving a single SKILL.md: prediction says zip, content is
    // md — only the forced format turns this into an install (US-5/6).
    const wired = coreServices(() => [{ kind: 'bytes', body: skillMarkdown('alpha', 'forced md') }]);
    expect(() => wired.install.installFromSourceSelection({ source: 'https://example.com/pack.zip', selectors: ['alpha'] })).toThrow(
      expect.objectContaining({ code: 'url_payload_mismatch' }),
    );
    const result = wired.install.installFromSourceSelection({ source: 'https://example.com/pack.zip', selectors: ['alpha'], format: 'md' });
    expect(result.installed).toEqual(['alpha']);
  });

  it('a forced zip format on non-zip bytes fails validation — no silent correction', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: buildTar([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }]), headers: opaque }]));
    expect(() => s.checkout('https://example.com/download', undefined, { format: 'zip' })).toThrow(expect.objectContaining({ code: 'archive_invalid' }));
  });

  it('a forced md format on zip bytes fails the frontmatter check', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: zipPayload(), headers: opaque }]));
    expect(() => s.checkout('https://example.com/download', undefined, { format: 'md' })).toThrow(expect.objectContaining({ code: 'url_payload_invalid' }));
  });

  it('a forced tar format on bzip2 bytes stays an explicit unsupported-format refusal', () => {
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: Buffer.from('BZh9' + 'x'.repeat(64)), headers: opaque }]));
    expect(() => s.checkout('https://example.com/download', undefined, { format: 'tar' })).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
  });

  it('a forced tar format on a pre-POSIX v7 tarball is refused — the extractor honors the ustar boundary, not a lucky checksum', () => {
    const v7 = buildV7Tar('alpha/SKILL.md', skillMarkdown('alpha', 'v7 tar'));
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), undefined, fakeHttp(() => [{ kind: 'bytes', body: v7, headers: opaque }]));
    expect(() => s.checkout('https://example.com/download', undefined, { format: 'tar' })).toThrow(expect.objectContaining({ code: 'archive_unsupported' }));
  });

  it('refuses the format flag on non-url sources — it only says how to parse a download', () => {
    const s = service(() => []);
    expect(() => s.checkout('owner/repo', undefined, { format: 'zip' })).toThrow(expect.objectContaining({ code: 'format_flag_misplaced' }));
  });

  it('rejects format values outside md|zip|tar at the CLI boundary', () => {
    expect(parseFormatFlag(undefined)).toBeUndefined();
    expect(parseFormatFlag('md')).toBe('md');
    expect(parseFormatFlag('zip')).toBe('zip');
    expect(parseFormatFlag('tar')).toBe('tar');
    expect(() => parseFormatFlag('tgz')).toThrow(expect.objectContaining({ code: 'invalid_format_flag' }));
  });
});

describe('every archive protection from ticket 02 applies to tar and tar.gz downloads (US-9/10/11)', () => {
  function tarRoutes(payload: Buffer): FakeHttpRoutes {
    return () => [{ kind: 'bytes', body: payload }];
  }

  it('refuses a member path escaping the extraction root', () => {
    const payload = buildTar([{ name: '../evil.txt', data: 'nope' }]);
    expect(() => service(tarRoutes(payload)).checkout('https://example.com/pack.tar')).toThrow(
      expect.objectContaining({ code: 'archive_member_path_unsafe' }),
    );
  });

  it('refuses members carrying the executable bit', () => {
    const payload = buildTar([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha') }, { name: 'alpha/run.sh', data: 'echo hi', mode: 0o755 }]);
    expect(() => service(tarRoutes(payload)).checkout('https://example.com/pack.tar')).toThrow(
      expect.objectContaining({ code: 'archive_member_forbidden' }),
    );
  });

  it('refuses symlink members resolving outside the extraction root', () => {
    const payload = buildTar([{ name: 'alpha/escape', typeflag: '2', linkname: '../../outside' }]);
    expect(() => service(tarRoutes(payload)).checkout('https://example.com/pack.tar')).toThrow(
      expect.objectContaining({ code: 'archive_symlink_escape' }),
    );
  });

  it('refuses hardlink, device, and fifo members', () => {
    for (const [typeflag, label] of [['1', 'hardlink'], ['3', 'char device'], ['6', 'fifo']] as const) {
      const payload = buildTar([{ name: 'alpha/member', typeflag, linkname: typeflag === '1' ? 'alpha/SKILL.md' : undefined }]);
      expect(() => service(tarRoutes(payload)).checkout('https://example.com/pack.tar'), label).toThrow(
        expect.objectContaining({ code: 'archive_member_forbidden' }),
      );
    }
  });

  it('enforces member-count and unpacked-size limits with the injected values', () => {
    const many = buildTar([1, 2, 3].map((index) => ({ name: `pkg/file${index}.txt`, data: 'x' })));
    const tight: ArchiveLimits = { maxArchiveBytes: 1_000_000, maxUnpackedBytes: 1_000_000, maxCompressionRatio: 100, maxMembers: 2 };
    expect(() => new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), tight, fakeHttp(tarRoutes(many))).checkout('https://example.com/pack.tar')).toThrow(
      expect.objectContaining({ code: 'archive_limit_exceeded' }),
    );
    const big = buildTar([{ name: 'pkg/blob.bin', data: Buffer.alloc(20_000) }]);
    expect(() => new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), { ...tight, maxMembers: 100, maxUnpackedBytes: 10_000 }, fakeHttp(tarRoutes(big))).checkout('https://example.com/pack.tar')).toThrow(
      expect.objectContaining({ code: 'archive_limit_exceeded' }),
    );
  });

  it('enforces the compression-ratio limit on the whole gzip layer (decompression bombs)', () => {
    const bomb = buildTarGz([{ name: 'pkg/zeros.bin', data: Buffer.alloc(1_000_000) }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), { maxArchiveBytes: 1_000_000, maxUnpackedBytes: 10_000_000, maxCompressionRatio: 10, maxMembers: 100 }, fakeHttp(tarRoutes(bomb)));
    expect(() => s.checkout('https://example.com/pack.tar.gz')).toThrow(expect.objectContaining({ code: 'archive_limit_exceeded' }));
  });

  it('refuses a tar.gz whose gunzip output exceeds the unpacked limit', () => {
    const bomb = buildTarGz([{ name: 'pkg/zeros.bin', data: Buffer.alloc(1_000_000) }]);
    const s = new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'), { maxArchiveBytes: 1_000_000, maxUnpackedBytes: 100_000, maxCompressionRatio: 10_000, maxMembers: 100 }, fakeHttp(tarRoutes(bomb)));
    expect(() => s.checkout('https://example.com/pack.tar.gz')).toThrow(expect.objectContaining({ code: 'archive_limit_exceeded' }));
  });

  it('accepts a pax-extended long-name entry (real-world bsdtar/git-archive layouts)', () => {
    const longDir = `${'l'.repeat(140)}`;
    const payload = buildTar([{ name: `${longDir}/SKILL.md`, data: skillMarkdown('alpha'), paxPath: `${longDir}/SKILL.md` }]);
    const s = service(tarRoutes(payload));
    const checkout = s.checkout('https://example.com/pack.tar');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
  });

  it('accepts a GNU longname entry (L typeflag)', () => {
    const longDir = 'g'.repeat(140);
    const payload = buildTar([{ name: `${longDir.slice(0, 99)}`, data: skillMarkdown('alpha'), gnuLongName: `${longDir}/SKILL.md` }]);
    const s = service(tarRoutes(payload));
    const checkout = s.checkout('https://example.com/pack.tar');
    expect(s.discover(checkout).map((skill) => skill.name)).toEqual(['alpha']);
    s.release(checkout);
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
