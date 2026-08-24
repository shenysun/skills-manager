import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function services(snapshotDate: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'doctor-catalog-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = { ...fixtureSnapshot(), source: { ...fixtureSnapshot().source, date: snapshotDate } };
  const git = {
    statusShort: () => '',
    clone: () => ({ repoDir: '', commit: null }),
    pull: () => null,
    latestCommit: () => null,
  };
  return createCoreServices({
    skillHomeRoot: root,
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: git as never,
    processRunner: { run: () => ({ stdout: '', stderr: '' }) } as never,
    userHome: path.join(root, 'user-home'),
    catalogSnapshot: snapshot,
  });
}

describe('doctor catalog snapshot age', () => {
  it('reports snapshot info in the report without warning when fresh', () => {
    const s = services('2026-08-20T00:00:00Z');
    const report = s.doctor.check();
    expect(report.catalog).toMatchObject({ source: 'injected', commit: 'fixture-commit' });
    expect(report.catalog.ageDays).toBeLessThan(90);
    expect(report.warnings.join('\n')).not.toMatch(/catalog snapshot/i);
  });

  it('warns with refresh guidance when the snapshot is stale', () => {
    const s = services('2025-01-01T00:00:00Z');
    const report = s.doctor.check();
    expect(report.warnings.join('\n')).toMatch(/Agent catalog snapshot is \d+ days old/);
    expect(report.warnings.join('\n')).toMatch(/catalog refresh/);
  });
});
