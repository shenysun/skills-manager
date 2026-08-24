import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogService } from '../../src/core/services/catalog-service.js';
import type { SkillHome } from '../../src/core/model/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { readFileSync as readUpstream } from 'node:fs';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempHome(): SkillHome {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-home-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    skillsDir: path.join(root, 'skills'),
    viewsDir: path.join(root, 'views'),
    collectionsDir: path.join(root, 'collections'),
    registryFile: path.join(root, 'registry.yaml'),
    activityFile: path.join(root, '.skills', 'activity.jsonl'),
  };
}

function upstreamFixture(name: string) {
  return readUpstream(path.join(import.meta.dirname, '..', 'fixtures', 'upstream', name), 'utf8');
}

function fakeFetch() {
  const commitApi = JSON.stringify([{ sha: 'newcommit123', commit: { committer: { date: '2026-08-20T00:00:00Z' } } }]);
  return async (url: string) => {
    if (url.includes('api.github.com')) return commitApi;
    if (url.endsWith('agents.ts')) return upstreamFixture('agents.ts');
    if (url.endsWith('detect-agent.ts')) return upstreamFixture('detect-agent.ts');
    throw new Error(`unexpected fetch ${url}`);
  };
}

describe('CatalogService.load', () => {
  it('returns an injected fixture snapshot without touching disk', () => {
    const home = tempHome();
    const service = new CatalogService(createNodeFileSystem(), home, { snapshot: fixtureSnapshot() });
    expect(service.load().agents.map((agent) => agent.id)).toContain('claude-code');
  });

  it('falls back to the bundled snapshot shipped with the package', () => {
    const home = tempHome();
    const service = new CatalogService(createNodeFileSystem(), home, {});
    const bundled = service.load();
    expect(bundled.agents.length).toBeGreaterThanOrEqual(70);
    expect(bundled.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(bundled.source.license).toBe('MIT');
  });

  it('prefers a hub refresh override over the bundled snapshot', () => {
    const home = tempHome();
    const fs = createNodeFileSystem();
    mkdirSync(path.join(home.root, '.skills'), { recursive: true });
    writeFileSync(path.join(home.root, '.skills', 'agent-catalog.json'), JSON.stringify(fixtureSnapshot()));
    const service = new CatalogService(fs, home, {});
    expect(service.load().source.commit).toBe('fixture-commit');
    expect(service.snapshotInfo().source).toBe('hub');
  });

  it('fails with an actionable error when the override is corrupt', () => {
    const home = tempHome();
    mkdirSync(path.join(home.root, '.skills'), { recursive: true });
    writeFileSync(path.join(home.root, '.skills', 'agent-catalog.json'), '{ not json');
    const service = new CatalogService(createNodeFileSystem(), home, {});
    expect(() => service.load()).toThrow(/catalog refresh/);
  });
});

describe('CatalogService.detected', () => {
  it('evaluates snapshot rules against the real filesystem and injected env', () => {
    const home = tempHome();
    const userHome = mkdtempSync(path.join(tmpdir(), 'catalog-user-'));
    cleanups.push(() => rmSync(userHome, { recursive: true, force: true }));
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    mkdirSync(path.join(userHome, '.cursor'), { recursive: true });
    const service = new CatalogService(createNodeFileSystem(), home, {
      snapshot: fixtureSnapshot(),
      env: {},
      userHomeDir: userHome,
    });
    expect(service.detected()).toEqual(['claude-code', 'cursor']);
  });
});

describe('CatalogService.refresh', () => {
  it('downloads upstream, extracts, and writes a hub override that load() then prefers', async () => {
    const home = tempHome();
    const fs = createNodeFileSystem();
    const service = new CatalogService(fs, home, { fetchText: fakeFetch() });
    const result = await service.refresh();
    expect(result.agentCount).toBeGreaterThanOrEqual(70);
    expect(result.commit).toBe('newcommit123');
    expect(existsSync(path.join(home.root, '.skills', 'agent-catalog.json'))).toBe(true);
    const written = JSON.parse(readFileSync(path.join(home.root, '.skills', 'agent-catalog.json'), 'utf8'));
    expect(written.source.commit).toBe('newcommit123');
    expect(service.load().source.commit).toBe('newcommit123');
    expect(service.snapshotInfo().source).toBe('hub');
  });

  it('keeps the previous snapshot when the download fails', async () => {
    const home = tempHome();
    const service = new CatalogService(createNodeFileSystem(), home, {
      fetchText: async () => {
        throw new Error('network down');
      },
    });
    await expect(service.refresh()).rejects.toThrow(/network down/);
    expect(service.snapshotInfo().source).toBe('bundled');
  });
});

describe('CatalogService.snapshotInfo', () => {
  it('reports snapshot age in days from the upstream stamp', () => {
    const home = tempHome();
    const service = new CatalogService(createNodeFileSystem(), home, {
      snapshot: fixtureSnapshot(),
      now: () => new Date('2026-08-31T00:00:00Z'),
    });
    const info = service.snapshotInfo();
    expect(info.source).toBe('injected');
    expect(info.commit).toBe('fixture-commit');
    expect(info.ageDays).toBe(30);
  });
});
