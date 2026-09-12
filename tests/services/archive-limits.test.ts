import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveLimitsFromEnv, DEFAULT_ARCHIVE_LIMITS } from '../../src/core/services/archive-safety.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown, writeZip } from '../fixtures/archives.js';
import { spyGit } from '../fixtures/spy-git.js';

/**
 * Extraction limits (spec source-formats, US-10): the four ruled values are
 * enforced on the full entry path — tests drive SourceService.checkout with a
 * real zip, the pre-agreed seam. Env overrides are a test-injectability
 * channel only (PO ruling): defaults are always the ruled values, env names
 * never surface in error messages or docs.
 */

let root: string;
let tempRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'archive-limits-'));
  tempRoot = path.join(root, 'tmp');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fs = createNodeFileSystem();

function service(limits?: Partial<typeof DEFAULT_ARCHIVE_LIMITS>) {
  return new SourceService(fs, spyGit(), tempRoot, { ...DEFAULT_ARCHIVE_LIMITS, ...limits });
}

function expectRejected(zipPath: string, messagePattern: RegExp, limits?: Partial<typeof DEFAULT_ARCHIVE_LIMITS>) {
  let thrown: Error | undefined;
  try {
    service(limits).checkout(zipPath);
  } catch (error) {
    thrown = error as Error;
  }
  expect((thrown as { code?: string } | undefined)?.code).toBe('archive_limit_exceeded');
  expect(thrown?.message).toMatch(messagePattern);
  expect(fs.readDirectory(tempRoot).filter((entry) => entry.name.startsWith('skills-source-'))).toEqual([]);
}

describe('archiveLimitsFromEnv — test injection channel, defaults never move (PO ruling)', () => {
  it('defaults are exactly the ruled values and junk env does not move them', () => {
    const ruled = { maxArchiveBytes: 104_857_600, maxUnpackedBytes: 524_288_000, maxCompressionRatio: 100, maxMembers: 10_000 };
    expect(archiveLimitsFromEnv(undefined)).toEqual(ruled);
    expect(archiveLimitsFromEnv({})).toEqual(ruled);
    expect(archiveLimitsFromEnv({
      SKILLS_MANAGER_ARCHIVE_MAX_BYTES: 'not-a-number',
      SKILLS_MANAGER_ARCHIVE_MAX_UNPACKED_BYTES: '0',
      SKILLS_MANAGER_ARCHIVE_MAX_COMPRESSION_RATIO: '-1',
      SKILLS_MANAGER_ARCHIVE_MAX_MEMBERS: '1.5',
    })).toEqual(ruled);
  });

  it('applies each positive-integer override independently', () => {
    expect(archiveLimitsFromEnv({ SKILLS_MANAGER_ARCHIVE_MAX_BYTES: '4096' }).maxArchiveBytes).toBe(4096);
    expect(archiveLimitsFromEnv({ SKILLS_MANAGER_ARCHIVE_MAX_UNPACKED_BYTES: '8192' }).maxUnpackedBytes).toBe(8192);
    expect(archiveLimitsFromEnv({ SKILLS_MANAGER_ARCHIVE_MAX_COMPRESSION_RATIO: '3' }).maxCompressionRatio).toBe(3);
    expect(archiveLimitsFromEnv({ SKILLS_MANAGER_ARCHIVE_MAX_MEMBERS: '2' }).maxMembers).toBe(2);
  });
});

describe('limit enforcement on the full entry path (US-10)', () => {
  it('rejects an archive over the archive-size limit before unpacking', () => {
    const zipPath = writeZip(root, 'big.zip', [{ name: 'skills/alpha/SKILL.md', data: 'x'.repeat(6_000), method: 'store' }]);
    expectRejected(zipPath, /maximum archive size of 5000 bytes/, { maxArchiveBytes: 5_000 });
  });

  it('rejects an archive over the member-count limit', () => {
    const zipPath = writeZip(root, 'members.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'skills/beta/SKILL.md', data: skillMarkdown('beta') },
      { name: 'skills/gamma/SKILL.md', data: skillMarkdown('gamma') },
    ]);
    expectRejected(zipPath, /3 members, exceeding the maximum of 2 members/, { maxMembers: 2 });
  });

  it('rejects an archive whose unpacked total exceeds the limit', () => {
    const zipPath = writeZip(root, 'total.zip', [
      { name: 'skills/alpha/blob-1.bin', data: 'x'.repeat(30_000), method: 'store' },
      { name: 'skills/alpha/blob-2.bin', data: 'x'.repeat(30_000), method: 'store' },
    ]);
    expectRejected(zipPath, /60000 bytes, exceeding the maximum of 50000 bytes/, { maxUnpackedBytes: 50_000 });
  });

  it('rejects a compression bomb under the default limits — no env injection needed', () => {
    const zipPath = writeZip(root, 'bomb.zip', [{ name: 'skills/alpha/SKILL.md', data: 'x'.repeat(300_000) }]);
    let thrown: Error | undefined;
    try {
      service().checkout(zipPath);
    } catch (error) {
      thrown = error as Error;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('archive_limit_exceeded');
    expect(thrown?.message).toMatch(/compression ratio/i);
    expect(fs.readDirectory(tempRoot).filter((entry) => entry.name.startsWith('skills-source-'))).toEqual([]);
  });

  it('an empty member does not trip the ratio check — zero-to-zero is a normal empty file', () => {
    const zipPath = writeZip(root, 'with-empty.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), method: 'store' },
      { name: 'skills/alpha/empty.txt', data: '', method: 'store' },
    ]);
    const s = service({ maxCompressionRatio: 1 });
    const checkout = s.checkout(zipPath);
    expect(fs.kind(path.join(checkout.repoDir, 'skills', 'alpha', 'empty.txt'))).toBe('file');
    s.release(checkout);
  });
});

describe('env injection reaches the composition root', () => {
  it('createCoreServices honors SKILLS_MANAGER_ARCHIVE_MAX_MEMBERS from options.env', () => {
    const zipPath = writeZip(root, 'two.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'skills/beta/SKILL.md', data: skillMarkdown('beta') },
    ]);
    const s = createCoreServices({
      skillHomeRoot: path.join(root, 'home'),
      projectRoot: root,
      fs: createNodeFileSystem(),
      git: spyGit(),
      processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
      tempRoot: path.join(root, 'tmp'),
      userHome: path.join(root, 'user'),
      env: { SKILLS_MANAGER_ARCHIVE_MAX_MEMBERS: '1' },
      catalogSnapshot: fixtureSnapshot(),
    });
    s.skillHome.ensure();
    let thrown: Error | undefined;
    try {
      s.install.installFromSourceSelection({ source: zipPath, selectors: [] });
    } catch (error) {
      thrown = error as Error;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('archive_limit_exceeded');
  });
});
