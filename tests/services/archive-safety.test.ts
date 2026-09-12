import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { skillMarkdown, symlinkEntry, writeZip, type ZipEntrySpec } from '../fixtures/archives.js';
import { spyGit } from '../fixtures/spy-git.js';

/**
 * Extraction-safety kernel (spec source-formats, US-9/10/11): every scenario
 * drives the FULL entry path — SourceService.checkout against a real temp
 * checkout — because the safety policy only counts where it is enforced
 * (spec Testing Decisions: no separate seam for the unpacker).
 */

let root: string;
let tempRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'archive-safety-'));
  tempRoot = path.join(root, 'tmp');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fs = createNodeFileSystem();

function service() {
  return new SourceService(fs, spyGit(), tempRoot);
}

/** A zip whose extraction would land `canaryName` at the test root (three
 *  levels above the temp checkout) if the safety policy failed. */
function slipZip(memberName: string, canaryName: string): string {
  return writeZip(root, 'slip.zip', [{ name: memberName, data: skillMarkdown('alpha') }, { name: canaryName, data: 'canary' }]);
}

function expectRejected(zipPath: string, code: string, canaryPath?: string) {
  let thrown: Error | undefined;
  try {
    service().checkout(zipPath);
  } catch (error) {
    thrown = error as Error;
  }
  expect((thrown as { code?: string } | undefined)?.code).toBe(code);
  if (canaryPath) expect(fs.kind(canaryPath)).toBe('missing');
  // A rejected archive must not leave its half-built checkout behind either.
  expect(fs.readDirectory(tempRoot).filter((entry) => entry.name.startsWith('skills-source-'))).toEqual([]);
}

describe('zip-slip member paths are rejected in every shape (US-9)', () => {
  it('rejects a ..-prefixed member path', () => {
    expectRejected(slipZip('../escape.txt', 'canary'), 'archive_member_path_unsafe', path.join(root, 'escape.txt'));
  });

  it('rejects a mid-path .. traversal', () => {
    expectRejected(slipZip('skills/../../escape.txt', 'canary'), 'archive_member_path_unsafe', path.join(root, 'escape.txt'));
  });

  it('rejects an absolute member path', () => {
    expectRejected(slipZip('/tmp/escape.txt', 'canary'), 'archive_member_path_unsafe');
  });

  it('rejects backslash traversal and drive-letter paths — separators are normalized on every platform', () => {
    expectRejected(slipZip('..\\..\\escape.txt', 'canary'), 'archive_member_path_unsafe');
    expectRejected(slipZip('C:\\evil.txt', 'canary'), 'archive_member_path_unsafe');
  });

  it('rejects a member name containing a NUL byte', () => {
    expectRejected(slipZip('evil\0name', 'canary'), 'archive_member_path_unsafe');
  });

  it('rejects an empty member name', () => {
    expectRejected(writeZip(root, 'empty.zip', [{ name: '', data: 'x' }]), 'archive_member_path_unsafe');
  });
});

describe('symlink members (US-9: targets must stay inside the extraction root)', () => {
  it('rejects a symlink whose target escapes the checkout', () => {
    // skills/alpha/link sits five levels below the test root; five .. reach it.
    const zipPath = writeZip(root, 'link.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      symlinkEntry('skills/alpha/link', '../../../../../canary-link'),
    ]);
    expectRejected(zipPath, 'archive_symlink_escape', path.join(root, 'canary-link'));
  });

  it('rejects an absolute-target symlink', () => {
    const zipPath = writeZip(root, 'abs-link.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      symlinkEntry('skills/alpha/passwd-link', '/etc/passwd'),
    ]);
    expectRejected(zipPath, 'archive_symlink_escape');
  });

  it('rejects an escape that only materializes through a symlink chain — lexical containment is not enough', () => {
    // b-link's own target resolves inside; a-link's target is lexically inside
    // but really resolves through b-link and out of the checkout.
    const zipPath = writeZip(root, 'chain.zip', [
      { name: 'deep/nested/placeholder.txt', data: 'x' },
      symlinkEntry('deep/nested/b-link', '../..'),
      symlinkEntry('a-link', 'deep/nested/b-link/../../../canary-chained'),
    ]);
    expectRejected(zipPath, 'archive_symlink_escape', path.join(root, 'canary-chained'));
  });

  it('rejects a cyclic symlink chain', () => {
    const zipPath = writeZip(root, 'cycle.zip', [
      symlinkEntry('x', 'y'),
      symlinkEntry('y', 'x'),
    ]);
    expectRejected(zipPath, 'archive_symlink_escape');
  });

  it('rejects a link whose own member PATH travels through an earlier link — nothing may be written outside the root before the verdict', () => {
    // a is an escaping link to the (existing) test root; b's member path goes
    // THROUGH a, so creating b would follow a and write outside the checkout.
    // The verdict must land before that write happens, not after.
    const zipPath = writeZip(root, 'via-link.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      symlinkEntry('skills/alpha/a', '../../../../..'),
      symlinkEntry('skills/alpha/a/b', 'x'),
    ]);
    expectRejected(zipPath, 'archive_symlink_escape', path.join(root, 'b'));
  });

  it('keeps a symlink whose target stays inside the checkout, as a real symlink', () => {
    const zipPath = writeZip(root, 'inside-link.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      symlinkEntry('skills/alpha/readme-link', 'SKILL.md'),
    ]);
    const checkout = service().checkout(zipPath);
    const linkPath = path.join(checkout.repoDir, 'skills', 'alpha', 'readme-link');
    expect(fs.kind(linkPath)).toBe('symlink');
    expect(fs.readlink(linkPath)).toBe('SKILL.md');
    service().release(checkout);
  });
});

describe('member file types (US-11)', () => {
  const forbidden: Array<[string, number]> = [
    ['character device', 0o020666],
    ['block device', 0o060644],
    ['fifo', 0o010644],
    ['socket', 0o140644],
  ];

  for (const [label, mode] of forbidden) {
    it(`rejects a ${label} member`, () => {
      const zipPath = writeZip(root, 'special.zip', [{ name: 'skills/alpha/device', data: 'x', mode, method: 'store' }]);
      expectRejected(zipPath, 'archive_member_forbidden');
    });
  }

  it('rejects a regular file carrying the executable bit', () => {
    const zipPath = writeZip(root, 'exec.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'skills/alpha/run.sh', data: '#!/bin/sh\n', mode: 0o100755, method: 'store' },
    ]);
    expectRejected(zipPath, 'archive_member_forbidden');
  });

  it('does not exec-check directories or symlinks — 0755 dirs and 0777 links are normal', () => {
    const zipPath = writeZip(root, 'normal-modes.zip', [
      { name: 'skills/', mode: 0o40755 },
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      symlinkEntry('skills/alpha/readme-link', 'SKILL.md'),
    ]);
    const checkout = service().checkout(zipPath);
    expect(checkout.kind).toBe('archive');
    service().release(checkout);
  });
});

describe('payload integrity (spec: content must match its declared shape)', () => {
  it('rejects a member whose bytes fail the CRC check', () => {
    const zipPath = writeZip(root, 'crc.zip', [{ name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), method: 'store' }]);
    const bytes = readFileSync(zipPath);
    const marker = bytes.indexOf(Buffer.from('fixture skill'));
    expect(marker).toBeGreaterThan(0);
    bytes[marker] = bytes[marker] === 0x66 ? 0x67 : 0x66; // flip one content byte, same length
    writeFileSync(zipPath, bytes);
    expectRejected(zipPath, 'archive_crc_mismatch');
  });

  it('rejects a member declaring more content than it inflates to', () => {
    const zipPath = writeZip(root, 'lying-big.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), declaredUncompressed: 10_000 },
    ]);
    expectRejected(zipPath, 'archive_corrupt');
  });

  it('rejects a member declaring less content than it really inflates to', () => {
    const zipPath = writeZip(root, 'lying-small.zip', [
      { name: 'skills/alpha/SKILL.md', data: 'x'.repeat(500), declaredUncompressed: 10 },
    ]);
    expectRejected(zipPath, 'archive_corrupt');
  });

  it('rejects a stored member whose declared size disagrees with its bytes', () => {
    const zipPath = writeZip(root, 'lying-stored.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), method: 'store', declaredUncompressed: 3 },
    ]);
    expectRejected(zipPath, 'archive_corrupt');
  });

  it('rejects an encrypted member', () => {
    const zipPath = writeZip(root, 'encrypted.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), flags: 0x0001 },
    ]);
    expectRejected(zipPath, 'archive_unsupported');
  });

  it('rejects an unsupported compression method with an explicit message', () => {
    const zipPath = writeZip(root, 'bzip2.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha'), methodCode: 12 },
    ]);
    let thrown: Error | undefined;
    try {
      service().checkout(zipPath);
    } catch (error) {
      thrown = error as Error;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('archive_unsupported');
    expect(thrown?.message).toMatch(/method/i);
  });
});
