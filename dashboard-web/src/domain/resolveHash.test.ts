import { describe, expect, it } from 'vitest';
import { resolveHash } from './resolveHash';

describe('resolveHash (single-page redirect shim)', () => {
  it('keeps the canonical hash as-is', () => {
    expect(resolveHash('')).toEqual({ hash: '', redirect: false });
    expect(resolveHash('#/')).toEqual({ hash: '', redirect: false });
  });

  it('redirects every legacy five-surface bookmark to the single page', () => {
    for (const legacy of ['#/overview', '#/installed', '#/sources', '#/registry', '#/activity']) {
      expect(resolveHash(legacy), legacy).toEqual({ hash: '', redirect: true });
    }
  });

  it('redirects the older legacy hashes too', () => {
    for (const legacy of ['#/discover', '#/updates', '#/settings', '#/sources?tab=discover', '#/sources/library']) {
      expect(resolveHash(legacy), legacy).toEqual({ hash: '', redirect: true });
    }
  });

  it('redirects any unknown hash — there is only one page', () => {
    expect(resolveHash('#/anything/else')).toEqual({ hash: '', redirect: true });
  });
});
