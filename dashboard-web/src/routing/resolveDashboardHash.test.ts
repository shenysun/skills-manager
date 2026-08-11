import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDashboardHash, sourcesTabFromHash } from './resolveDashboardHash.ts';

describe('resolveDashboardHash', () => {
  it('maps first-class hashes to surfaces', () => {
    for (const surface of ['overview', 'installed', 'sources', 'registry', 'activity'] as const) {
      const resolved = resolveDashboardHash(`#/${surface}`);
      assert.equal(resolved.surface, surface);
      assert.equal(resolved.redirectHash, null);
    }
  });

  it('defaults empty hash to overview', () => {
    const resolved = resolveDashboardHash('');
    assert.equal(resolved.surface, 'overview');
    assert.equal(resolved.redirectHash, null);
  });

  it('opens sources discover via query deep-link without redirect', () => {
    const resolved = resolveDashboardHash('#/sources?tab=discover');
    assert.equal(resolved.surface, 'sources');
    assert.equal(resolved.sourcesTab, 'discover');
    assert.equal(resolved.redirectHash, null);
  });

  it('normalizes path form discover to query deep-link', () => {
    const resolved = resolveDashboardHash('#/sources/discover');
    assert.equal(resolved.surface, 'sources');
    assert.equal(resolved.sourcesTab, 'discover');
    assert.equal(resolved.redirectHash, '#/sources?tab=discover');
  });

  it('redirects legacy discover to sources discover', () => {
    const resolved = resolveDashboardHash('#/discover');
    assert.equal(resolved.surface, 'sources');
    assert.equal(resolved.sourcesTab, 'discover');
    assert.equal(resolved.redirectHash, '#/sources?tab=discover');
  });

  it('redirects legacy updates to installed (never sources)', () => {
    const resolved = resolveDashboardHash('#/updates');
    assert.equal(resolved.surface, 'installed');
    assert.equal(resolved.redirectHash, '#/installed');
  });

  it('redirects legacy settings to activity', () => {
    const resolved = resolveDashboardHash('#/settings');
    assert.equal(resolved.surface, 'activity');
    assert.equal(resolved.redirectHash, '#/activity');
  });

  it('defaults sources without tab to library', () => {
    const resolved = resolveDashboardHash('#/sources');
    assert.equal(resolved.surface, 'sources');
    assert.equal(resolved.sourcesTab, 'library');
    assert.equal(resolved.redirectHash, null);
  });
});

describe('sourcesTabFromHash', () => {
  it('reads discover tab from deep-link', () => {
    assert.equal(sourcesTabFromHash('#/sources?tab=discover'), 'discover');
  });

  it('defaults non-sources hashes to library', () => {
    assert.equal(sourcesTabFromHash('#/installed'), 'library');
  });
});
